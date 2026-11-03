// Inline styles of the compose/create pages (WhatsApp-like template preview).
export const PREVIEW_CSS = `
.preview-wrap { max-width: 460px; }
.wh-card { border: 0; border-radius: 1rem; box-shadow: 0 10px 30px rgba(15,23,42,.08); overflow: hidden; background: #fff; }
.wh-card .media-wrap { background: #fff; padding: .75rem; }
.wh-card .media-wrap img { width: 100%; border-radius: .75rem; display: block; }
.wh-msg { margin: .75rem; background: #fff; border-radius: .9rem; padding: 1rem 1rem .5rem; position: relative; border: 1px solid #eef2f7; }
.wh-msg::before { content: ""; position: absolute; left: -8px; top: 16px; width: 0; height: 0; border-right: 8px solid #fff;
  border-top: 8px solid transparent; border-bottom: 8px solid transparent; filter: drop-shadow(-1px 0 0 #eef2f7); }
.wh-time { text-align: right; font-size: .8rem; color: #94a3b8; }
.wh-action { display: flex; align-items: center; justify-content: center; gap: .5rem; padding: .9rem 1rem; text-decoration: none;
  color: #0d6efd; background: #fff; border-top: 1px solid #eef2f7; font-weight: 500; }
.wh-action:hover { background: #f8fafc; }
`;
