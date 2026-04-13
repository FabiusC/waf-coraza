export type Event = {
  time: string;
  method: string;
  path: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
  cookies: Array<{ name: string; value: string }>;
  body?: string;
  clientIp: string;
  userAgent: string;
  status: number;
  blocked: boolean;
  ruleIds: string;
  messages: string;
  transactionId: string;
  durationMs: number;
  curlCommand?: string;
  responseBody?: string;
};

export type Snapshot = {
  stats: {
    total: number;
    allowed: number;
    blocked: number;
  };
  recent: Event[];
  generated: string;
};
