import { FieldError } from '@/components/ActionForm';
import { allowedCategories, CATEGORY_LABELS, TEMPLATE_CATEGORIES } from '@/lib/template-categories';

/**
 * Template categories the account may send (admin user form). All ticked = no
 * restriction; e.g. only Utility for a client sold utility messages only.
 */
export function TemplateCategoriesField({ value }: { value: string | null }) {
  const allowed = allowedCategories(value);
  return (
    <div className="col-12">
      <label className="form-label mb-1">Allowed Template Categories</label>
      <input type="hidden" name="template_categories_form" value="1" />
      <div className="d-flex flex-wrap gap-4">
        {TEMPLATE_CATEGORIES.map((c) => (
          <div className="form-check" key={c}>
            <input className="form-check-input" type="checkbox" id={`tpl_cat_${c}`} name="template_categories" value={c}
              defaultChecked={allowed === null || allowed.includes(c)} />
            <label className="form-check-label" htmlFor={`tpl_cat_${c}`}>{CATEGORY_LABELS[c]}</label>
          </div>
        ))}
      </div>
      <FieldError name="template_categories" />
      <div className="form-text">
        Untick a category to block it, e.g. tick only Utility for a utility-only client. Templates of other categories are hidden
        from the client and are not sent (also through the API). Combine with the Template Message Limit to cap the total.
      </div>
    </div>
  );
}
