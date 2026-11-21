export const publicRoutes=[
  {
    "method": "POST",
    "path": "/api/login",
    "alasan": "Login mendapatkan sesi sebelum tenant dapat dipilih."
  },
  {
    "method": "GET",
    "path": "/api/health",
    "alasan": "Liveness publik tanpa data tenant."
  },
  {
    "method": "USE",
    "path": "/*",
    "alasan": "Static assets dari direktori public saja."
  }
];
export const pending=[
  {
    "method": "GET",
    "path": "/api/numbers/:id/ai",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "PATCH",
    "path": "/api/numbers/:id/ai",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/numbers/:id/ai/usage",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/numbers/:id/ai/logs",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers/:id/ai/test",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers/:id/ai/resume",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/ai/alerts",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers/:id/ai/profile-draft",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers/:id/products/ai-draft",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/numbers/:id/products",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers/:id/products",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "PATCH",
    "path": "/api/numbers/:id/products/:productId",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "DELETE",
    "path": "/api/numbers/:id/products/:productId",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/orders",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "PATCH",
    "path": "/api/orders/:id/status",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/chats/:chatId/media-url",
    "pr": "T08",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T08; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/monitor",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/activity",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/search",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/backups",
    "pr": "T13",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T13; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/backups",
    "pr": "T13",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T13; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/backups/:name",
    "pr": "T13",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T13; perilaku tetap pada T02."
  },
  {
    "method": "DELETE",
    "path": "/api/backups/:name",
    "pr": "T13",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T13; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/numbers",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers/:id/start",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers/:id/pairing",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/numbers/:id/qr",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/numbers/:id/quota",
    "pr": "T07",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T07; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers/:id/reconnect",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "PATCH",
    "path": "/api/numbers/:id/name",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/numbers/:id/chats",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "PATCH",
    "path": "/api/chats/:chatId/pin",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "PATCH",
    "path": "/api/chats/:chatId/status",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "PUT",
    "path": "/api/chats/:chatId/name",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/chats/:chatId/messages",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/chats/:chatId/export",
    "pr": "T13",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T13; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/chats/:chatId/send",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/chats/:chatId/react",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/chats/:chatId/unread",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/chats/:chatId/media",
    "pr": "T08",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T08; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/chats/:chatId/read",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "PATCH",
    "path": "/api/chats/:chatId/assign",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/notifications",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/notifications/count",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/notifications/read",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/numbers/:id/rules",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/numbers/:id/rules",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "PATCH",
    "path": "/api/rules/:id",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "DELETE",
    "path": "/api/rules/:id",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/templates",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/templates",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "DELETE",
    "path": "/api/templates/:id",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "GET",
    "path": "/api/labels",
    "pr": "T05",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T05; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/labels",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "DELETE",
    "path": "/api/labels/:id",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "POST",
    "path": "/api/chats/:chatId/labels/:labelId",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "DELETE",
    "path": "/api/chats/:chatId/labels/:labelId",
    "pr": "T06",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T06; perilaku tetap pada T02."
  },
  {
    "method": "USE",
    "path": "/media/*",
    "pr": "T08",
    "alasan": "Rute legacy: scope tenant dikerjakan pada T08; perilaku tetap pada T02."
  }
];
