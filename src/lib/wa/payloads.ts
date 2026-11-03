// Builds the WhatsApp Cloud API request(s) for one queued js_message row.
// Port of the payload-building branches of Common::fun_send_whatsapp_meta() and
// fun_send_whatsapp_template(). Pure functions: no I/O, so they can be unit tested.
//
// Deliberate fixes vs. PHP (see docs/MIGRATION_NOTES.md):
//  - every message starts from a fresh payload (PHP reused $post_data / $json_data
//    across loop iterations, so a message could inherit the previous one's header,
//    buttons or attachments);
//  - components / list rows are always sequential arrays (PHP could emit JSON objects
//    with gaps, which Meta rejects).
import {
  CATALOGUE_TEXT,
  flowButtonIndex,
  templateLanguage,
  templateName,
  templateParamSeparator,
} from "./client-rules";
import { fileNameOf, mediaTypeOf, type MediaType, type SavedMedia } from "./media";
import { MetaApi } from "./meta-api";

export type QueuedMessage = {
  msgId: bigint;
  userId: number;
  mobileNo: string; // already prefixed with 91
  msg: string;
  msgType: string;
  title: string;
  buttons: string;
  extImg: string;
  templateName: string;
  templatePara: string;
  msgLite: number;
  btnUrl: string;
};

export type CatalogueItem = { c_catalogue_id: string | null; c_model: string | null; c_item_id: string | null };

/** One API call. `ids`: take message ids from this response (mirrors PHP). */
export type Step = { api: MetaApi; body: Record<string, unknown>; ids: boolean };

type Media = { type: MediaType; link: string; filename?: string };

const decodeEntities = (s: string) => s.replace(/&#39;/g, "'").replace(/&#34;/g, '"');

function headerParam(m: Media) {
  return {
    type: m.type,
    [m.type]: { link: m.link, ...(m.type === "document" && m.filename ? { filename: m.filename } : {}) },
  };
}

function bodyComponent(para: string, separator: string) {
  return {
    type: "body",
    parameters: para.split(separator).map((text) => ({ type: "text", text })),
  };
}

const extMedia = (extImg: string): Media[] =>
  extImg
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((link) => ({ type: mediaTypeOf(link), link, filename: fileNameOf(link) }));

const savedToMedia = (s: SavedMedia): Media => ({ type: s.type, link: s.url, filename: s.filename });

// ------------------------------------------------------------------ templates

export function buildTemplate(
  m: QueuedMessage,
  baseMedia: SavedMedia[],
  opts: { templateVariant: boolean },
): Step {
  const name = templateName(m.templateName);
  const components: Record<string, unknown>[] = [];

  // Header: external URLs; the meta path uses base files only when there are none,
  // the template path lets base files override the same positions.
  let header: Media[] = extMedia(m.extImg);
  if (opts.templateVariant || header.length === 0) {
    const fromBase = baseMedia.map(savedToMedia);
    header = header.length ? header.map((h, i) => fromBase[i] ?? h).concat(fromBase.slice(header.length)) : fromBase;
  }
  if (header.length) components.push({ type: "header", parameters: header.map(headerParam) });

  if (m.templatePara) components.push(bodyComponent(m.templatePara, templateParamSeparator(m.userId)));

  if (m.btnUrl) {
    const query = new URL(m.btnUrl, "http://x").searchParams.toString();
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `?${query}` }] });
  }

  return {
    api: m.msgLite === 1 ? MetaApi.MarketingMessage : MetaApi.SendMessage,
    ids: true,
    body: {
      messaging_product: "whatsapp",
      to: m.mobileNo,
      type: "template",
      template: {
        name,
        language: { code: templateLanguage(name, m.userId, opts.templateVariant) },
        ...(components.length ? { components } : {}),
      },
    },
  };
}

export function buildFlow(m: QueuedMessage, baseMedia: SavedMedia[]): Step {
  const name = templateName(m.templateName, { flow: true });
  const components: Record<string, unknown>[] = [];
  const header = m.extImg ? extMedia(m.extImg) : baseMedia.map(savedToMedia);
  if (header.length) components.push({ type: "header", parameters: header.map(headerParam) });
  if (m.templatePara) components.push(bodyComponent(m.templatePara, templateParamSeparator(m.userId)));
  components.push({ type: "button", sub_type: "flow", index: flowButtonIndex(m.templateName, m.userId) });
  return {
    api: MetaApi.SendMessage,
    ids: true,
    body: { messaging_product: "whatsapp", to: m.mobileNo, type: "template", template: { name, language: { code: "en" }, components } },
  };
}

/** OTP template: body parameters, and the last parameter (the code) is the URL button text. */
export function buildAuthentication(m: QueuedMessage): Step {
  const params = m.templatePara ? m.templatePara.split(",") : [];
  const components: Record<string, unknown>[] = [];
  if (params.length) components.push(bodyComponent(m.templatePara, ","));
  components.push({
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text: params.at(-1) ?? "" }],
  });
  return {
    api: MetaApi.SendMessage,
    ids: true,
    body: { messaging_product: "whatsapp", to: m.mobileNo, type: "template", template: { name: m.templateName, language: { code: "en" }, components } },
  };
}

export function buildCatalogue(m: QueuedMessage, kind: "catalogue" | "product_list", items: CatalogueItem[]): Step | null {
  if (!items.length) return null;
  const text = CATALOGUE_TEXT[kind];
  return {
    api: MetaApi.SendMessage,
    ids: true,
    body: {
      messaging_product: "whatsapp",
      to: m.mobileNo,
      type: "interactive",
      interactive: {
        type: "product_list",
        header: { type: "text", text: `TGMA ${m.title}` },
        body: { text: text.body },
        footer: { text: text.footer },
        action: {
          catalog_id: items[0].c_catalogue_id,
          sections: [{ title: items[0].c_model, product_items: items.map((i) => ({ product_retailer_id: i.c_item_id })) }],
        },
      },
    },
  };
}

// ------------------------------------------------------------------ text (+ media, buttons, list)

const base = (to: string) => ({ messaging_product: "whatsapp", recipient_type: "individual", to });

const textStep = (to: string, body: string): Step => ({
  api: MetaApi.SendMessage,
  ids: false,
  body: { ...base(to), type: "text", text: { preview_url: "false", body } },
});

const mediaStep = (to: string, m: Media, caption?: string): Step => ({
  api: MetaApi.SendMessage,
  ids: false,
  body: {
    ...base(to),
    type: m.type,
    [m.type]: {
      link: m.link,
      ...(caption !== undefined ? { caption } : {}),
      ...(m.type === "document" && m.filename ? { filename: m.filename } : {}),
    },
  },
});

/** Returns the API calls for a text message plus the media URLs recorded in m_response_file_name. */
export function buildText(m: QueuedMessage, baseMedia: SavedMedia[]): { steps: Step[]; sendFiles: string[] } {
  // External URLs replace base-file attachments, as in PHP.
  const media: Media[] = m.extImg
    ? extMedia(m.extImg).map((x) => (x.link.includes("youtube") ? { type: "video", link: x.link } : x))
    : baseMedia.map(savedToMedia);
  const sendFiles = m.extImg ? baseMedia.map((b) => b.url).concat(media.map((x) => x.link)) : media.map((x) => x.link);

  const to = m.mobileNo;
  const msg = decodeEntities(m.msg);
  const buttons = m.buttons.split(",").filter((b) => b !== "");
  const steps: Step[] = [];

  if (!m.buttons && media.length === 0) {
    steps.push(textStep(to, msg));
  } else if (!m.buttons && media.length === 1 && sendFiles.length === 1) {
    steps.push(mediaStep(to, media[0], msg));
  } else if (m.buttons) {
    const interactive: Record<string, unknown> = { body: { text: msg } };
    let mediaInHeader = false;
    if (media.length > 0 && buttons.length <= 3) {
      const h = media[0];
      interactive.header = {
        type: h.type,
        [h.type]: { link: h.link, ...(h.type === "document" && h.filename ? { filename: h.filename } : {}) },
      };
      mediaInHeader = true;
    }
    if (buttons.length <= 3) {
      interactive.type = "button";
      interactive.action = {
        buttons: buttons.map((title, i) => ({ type: "reply", reply: { title, id: `btn${i + 1}` } })),
      };
    } else {
      interactive.type = "list";
      interactive.action = {
        button: "Choose One",
        sections: [{ title: "Menu", rows: buttons.map((title, i) => ({ id: `btn${i + 1}`, title })) }],
      };
    }
    steps.push({ api: MetaApi.SendMessage, ids: false, body: { ...base(to), type: "interactive", interactive } });
    media.forEach((x, i) => {
      if (i === 0 && mediaInHeader) return;
      steps.push(mediaStep(to, x));
    });
  } else {
    // Several attachments without buttons: the text first, then each file.
    steps.push(textStep(to, msg));
    media.forEach((x) => steps.push(mediaStep(to, x)));
  }

  // PHP recorded message ids from the last response only.
  steps[steps.length - 1].ids = true;
  return { steps, sendFiles };
}
