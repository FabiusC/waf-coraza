FROM golang:1.24-alpine AS build

WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/waf .

FROM gcr.io/distroless/base-debian12:nonroot

WORKDIR /
COPY --from=build /out/waf /waf

EXPOSE 8080

CMD ["/waf"]