package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/corazawaf/coraza/v3"
	"github.com/corazawaf/coraza/v3/types"
)

type Event struct {
	Time          string `json:"time"`
	Method        string `json:"method"`
	Path          string `json:"path"`
	ClientIP      string `json:"clientIp"`
	UserAgent     string `json:"userAgent"`
	Status        int    `json:"status"`
	Blocked       bool   `json:"blocked"`
	RuleIDs       string `json:"ruleIds"`
	Messages      string `json:"messages"`
	TransactionID string `json:"transactionId"`
	DurationMS    int64  `json:"durationMs"`
}

type Stats struct {
	Total   int `json:"total"`
	Allowed int `json:"allowed"`
	Blocked int `json:"blocked"`
}

type Snapshot struct {
	Stats     Stats   `json:"stats"`
	Recent    []Event `json:"recent"`
	Generated string  `json:"generated"`
}

type Store struct {
	mu      sync.Mutex
	total   int
	allowed int
	blocked int
	recent  []Event
}

func (s *Store) Add(event Event) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.total++
	if event.Blocked {
		s.blocked++
	} else {
		s.allowed++
	}

	s.recent = append([]Event{event}, s.recent...)
	if len(s.recent) > 20 {
		s.recent = s.recent[:20]
	}
}

func (s *Store) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	recent := make([]Event, len(s.recent))
	copy(recent, s.recent)

	return Snapshot{
		Stats: Stats{
			Total:   s.total,
			Allowed: s.allowed,
			Blocked: s.blocked,
		},
		Recent:    recent,
		Generated: time.Now().Format(time.RFC3339),
	}
}

type responseRecorder struct {
	header     http.Header
	body       bytes.Buffer
	statusCode int
}

func newResponseRecorder() *responseRecorder {
	return &responseRecorder{header: make(http.Header)}
}

func (r *responseRecorder) Header() http.Header {
	return r.header
}

func (r *responseRecorder) WriteHeader(statusCode int) {
	if r.statusCode == 0 {
		r.statusCode = statusCode
	}
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	if r.statusCode == 0 {
		r.statusCode = http.StatusOK
	}
	return r.body.Write(data)
}

type ruleSummary struct {
	ids      []string
	messages []string
}

func main() {
	store := &Store{}
	waf, err := createWAF()
	if err != nil {
		log.Fatalf("no se pudo inicializar Coraza: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/app", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = fmt.Fprintln(w, "Aplicacion protegida por Coraza WAF")
	})
	mux.HandleFunc("/api/stats", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(store.Snapshot())
	})
	mux.HandleFunc("/api/recent", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(store.Snapshot().Recent)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	addr := ":" + port
	log.Printf("servidor escuchando en http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, corsMiddleware(wafMiddleware(waf, store, mux))))
}

func createWAF() (coraza.WAF, error) {
	return coraza.NewWAF(coraza.NewWAFConfig().WithDirectives(`
SecRule REQUEST_URI "@rx (?i)(/admin|/wp-admin|/phpmyadmin|\.\./|union\s+select|<script)" "id:1001,phase:1,deny,status:403,log,msg:'ruta sospechosa detectada'"
SecRule REQUEST_HEADERS:User-Agent "@rx (?i)(sqlmap|nikto|nmap|masscan|python-requests)" "id:1002,phase:1,deny,status:403,log,msg:'user-agent malicioso detectado'"
`))
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func wafMiddleware(waf coraza.WAF, store *Store, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		tx := waf.NewTransactionWithID(strconv.FormatInt(time.Now().UnixNano(), 10))
		defer func() {
			tx.ProcessLogging()
			tx.Close()
		}()

		clientIP, clientPort := splitHostPortOrDefault(r.RemoteAddr, 0)
		serverHost, serverPort := splitHostPortOrDefault(r.Host, 8080)
		if serverHost == "" {
			serverHost = "localhost"
		}

		tx.ProcessConnection(clientIP, clientPort, serverHost, serverPort)
		tx.SetServerName(stripPort(r.Host))
		tx.ProcessURI(r.URL.RequestURI(), r.Method, r.Proto)

		for key, values := range r.Header {
			for _, value := range values {
				tx.AddRequestHeader(key, value)
			}
		}
		if r.Host != "" {
			tx.AddRequestHeader("Host", r.Host)
		}

		interruption := tx.ProcessRequestHeaders()
		summary := summarizeRules(tx.MatchedRules())

		if interruption != nil {
			statusCode := interruption.Status
			if statusCode == 0 {
				statusCode = http.StatusForbidden
			}

			store.Add(newEvent(r, tx.ID(), statusCode, true, summary, time.Since(start)))
			http.Error(w, http.StatusText(statusCode), statusCode)
			return
		}

		recorder := newResponseRecorder()
		next.ServeHTTP(recorder, r)
		if recorder.statusCode == 0 {
			recorder.statusCode = http.StatusOK
		}

		copyHeaders(w.Header(), recorder.header)
		w.WriteHeader(recorder.statusCode)
		_, _ = io.Copy(w, &recorder.body)

		store.Add(newEvent(r, tx.ID(), recorder.statusCode, false, summary, time.Since(start)))
	})
}

func newEvent(r *http.Request, transactionID string, statusCode int, blocked bool, summary ruleSummary, duration time.Duration) Event {
	return Event{
		Time:          time.Now().Format(time.RFC3339),
		Method:        r.Method,
		Path:          r.URL.RequestURI(),
		ClientIP:      requestIP(r.RemoteAddr),
		UserAgent:     r.UserAgent(),
		Status:        statusCode,
		Blocked:       blocked,
		RuleIDs:       strings.Join(summary.ids, ", "),
		Messages:      strings.Join(summary.messages, "; "),
		TransactionID: transactionID,
		DurationMS:    duration.Milliseconds(),
	}
}

func summarizeRules(rules []types.MatchedRule) ruleSummary {
	ids := make([]string, 0, len(rules))
	messages := make([]string, 0, len(rules))

	for _, rule := range rules {
		metadata := rule.Rule()
		ids = append(ids, strconv.Itoa(metadata.ID()))
		if message := strings.TrimSpace(rule.Message()); message != "" {
			messages = append(messages, message)
		}
	}

	sort.Strings(ids)
	return ruleSummary{ids: ids, messages: messages}
}

func copyHeaders(dst http.Header, src http.Header) {
	for key, values := range src {
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func requestIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}

func splitHostPortOrDefault(value string, fallbackPort int) (string, int) {
	host, portString, err := net.SplitHostPort(value)
	if err != nil {
		return stripPort(value), fallbackPort
	}

	port, err := strconv.Atoi(portString)
	if err != nil {
		port = fallbackPort
	}

	return host, port
}

func stripPort(value string) string {
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	return value
}
