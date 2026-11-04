import { countVariables, templateButtons, templateCards, templateParameterCount } from '@/lib/format';
import { decodeEntities, limit } from '@/lib/text';
import type { TemplateRow } from '@/lib/types';

/**
 * Template preview and send inputs for the compose screen
 * (templates/_preview.blade.php and _inputs.blade.php). Pure components:
 * rendered on the server for a preselected template and in the browser
 * after the template picker changes.
 */

export type ComposeTemplate = Pick<TemplateRow,
  'ut_id' | 'ut_name' | 'ut_template_type' | 'ut_header_type' | 'ut_header' | 'ut_message' | 'ut_parameters' | 'ut_footer' | 'ut_buttons' | 'ut_cards'>;

export const COMPOSE_TEMPLATE_COLUMNS =
  'ut_id, ut_name, ut_template_type, ut_header_type, ut_header, ut_message, ut_parameters, ut_footer, ut_buttons, ut_cards';

const BUTTON_ICONS: Record<string, string> = { URL: 'ri-external-link-line', PHONE_NUMBER: 'ri-phone-line' };

export function TemplatePreview({ template }: { template: ComposeTemplate }) {
  const message = decodeEntities(template.ut_message ?? '');
  if (template.ut_template_type === 'carousel') {
    return (
      <>
        <div className="wh-card mb-2"><div className="wh-msg">{message}</div></div>
        <div className="wh-carousel">
          {templateCards(template).map((card, i) => (
            <div className="wh-card" key={i}>
              <div className="media-wrap">
                {card.header_type === 'VIDEO' ? <video controls src={card.header} /> : <img src={card.header} alt="Card image" />}
              </div>
              <div className="wh-msg">{card.body}</div>
              {(card.buttons ?? []).map((b, j) => (
                <div className="wh-action" key={j}><i className={BUTTON_ICONS[b.type ?? ''] ?? 'ri-reply-line'} /> {b.text ?? ''}</div>
              ))}
            </div>
          ))}
        </div>
      </>
    );
  }
  const header = template.ut_header_type;
  return (
    <div className="wh-card">
      {header && (
        <div className="media-wrap">
          {header === 'IMAGE' ? <img src={template.ut_header ?? ''} alt="Header image" />
            : header === 'VIDEO' ? <video controls src={template.ut_header ?? ''} />
              : header === 'DOCUMENT' ? <div className="p-3 bg-light rounded text-center"><i className="ri-file-pdf-2-line fs-2" /><br />Document</div>
                : <strong>{decodeEntities(template.ut_header ?? '')}</strong>}
        </div>
      )}
      <div className="wh-msg">{message}</div>
      {template.ut_footer && <div className="wh-footer">{template.ut_footer}</div>}
      {templateButtons(template).map((b, i) => (
        <div className="wh-action" key={i}><i className="ri-reply-line" /> {b.text ?? ''}</div>
      ))}
    </div>
  );
}

const HEADER_UPLOAD: Record<string, [string, string, string]> = {
  IMAGE: ['Header Image', 'image/png,image/jpeg', '.jpg, .jpeg, .png'],
  DOCUMENT: ['Header Document', 'application/pdf', '.pdf'],
  VIDEO: ['Header Video', 'video/mp4', '.mp4'],
};
const CARD_ACCEPT: Record<string, [string, string]> = { IMAGE: ['image/png,image/jpeg', 'JPG or PNG'], VIDEO: ['video/mp4', 'MP4'] };

export function TemplateInputs({ template }: { template: ComposeTemplate }) {
  const count = templateParameterCount(template);
  const header = HEADER_UPLOAD[template.ut_header_type ?? ''];
  return (
    <>
      {Array.from({ length: count }, (_, k) => k + 1).map((i) => (
        <div className="mb-3" key={i}>
          <label htmlFor={`body_parameters_${i}`} className="form-label">Parameter {`{{${i}}}`} Value <span className="text-danger">*</span></label>
          <input name="body_parameters[]" id={`body_parameters_${i}`} type="text" className="form-control" required />
        </div>
      ))}

      {header && (
        <div className="mb-3">
          <label htmlFor="img_value" className="form-label">{header[0]} <span className="text-danger">*</span></label>
          <input name="img_value[]" id="img_value" type="file" className="form-control" accept={header[1]} required />
          <div className="form-text">Upload {header[2]}</div>
        </div>
      )}

      {template.ut_template_type === 'carousel' && templateCards(template).map((card, c) => {
        const accept = CARD_ACCEPT[card.header_type] ?? CARD_ACCEPT.IMAGE;
        return (
          <div className="border rounded p-3 mb-3" key={c}>
            <p className="fw-semibold mb-2">Card {c + 1} <span className="text-muted fw-normal small">— {limit(card.body, 60)}</span></p>
            <div className="mb-2">
              <label htmlFor={`card_media_${c}`} className="form-label small mb-1">Card {card.header_type === 'VIDEO' ? 'Video' : 'Image'} <span className="text-danger">*</span></label>
              <input type="file" className="form-control form-control-sm" name={`cards[${c}][media]`} id={`card_media_${c}`} accept={accept[0]} required />
              <div className="form-text">Upload {accept[1]}</div>
            </div>
            {Array.from({ length: countVariables(card.body) }, (_, k) => k + 1).map((i) => (
              <div className="mb-2" key={i}>
                <label htmlFor={`card_${c}_param_${i}`} className="form-label small mb-1">Card Text {`{{${i}}}`} Value <span className="text-danger">*</span></label>
                <input type="text" className="form-control form-control-sm" name={`cards[${c}][params][]`} id={`card_${c}_param_${i}`} required />
              </div>
            ))}
            {(card.buttons ?? []).map((button, b) => (button.type === 'URL' && countVariables(button.url ?? '') ? (
              <div className="mb-2" key={b}>
                <label htmlFor={`card_${c}_url_${b}`} className="form-label small mb-1">“{button.text}” link ending <span className="text-danger">*</span></label>
                <div className="input-group input-group-sm">
                  <span className="input-group-text text-truncate" style={{ maxWidth: '50%' }}>{String(button.url).replace(/\{\{\s*1\s*\}\}$/, '')}</span>
                  <input type="text" className="form-control" name={`cards[${c}][url_params][${b}]`} id={`card_${c}_url_${b}`} required />
                </div>
              </div>
            ) : null))}
          </div>
        );
      })}
    </>
  );
}
