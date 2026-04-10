export type Event = {
  time: string;
  method: string;
  path: string;
  clientIp: string;
  userAgent: string;
  status: number;
  blocked: boolean;
  ruleIds: string;
  messages: string;
  transactionId: string;
  durationMs: number;
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
