// Frontend::fun_select_page_no(): First, a sliding window of up to 20 page links, Last.
// Filters are carried in the query string (the PHP kept them in the session).
export default function Pager({
  pages,
  page,
  colSpan,
  query,
}: {
  pages: number;
  page: number;
  colSpan: number;
  query: Record<string, string>;
}) {
  if (pages <= 1) return null;
  const NO_OF_PAGE = 20;
  const CHANGE = 10;
  let start = 1;
  let end = pages;
  if (pages > NO_OF_PAGE) {
    if (page >= NO_OF_PAGE) {
      start = page - CHANGE;
      end = page + CHANGE;
      if (end > pages) {
        end = pages;
        start = end - NO_OF_PAGE;
      }
    } else {
      end = NO_OF_PAGE;
    }
  }
  const href = (p: number) => {
    const q = new URLSearchParams({ ...query, curpage: String(p) });
    q.delete("s");
    return `?${q.toString()}`;
  };
  const links = [];
  for (let i = Math.max(1, start); i <= end; i++) links.push(i);
  return (
    <tr style={{ backgroundColor: "#eeeeee" }}>
      <td valign="top" colSpan={colSpan} className="text-center">
        {page > 1 && (
          <>
            <a href={href(1)}>First</a>&nbsp;&nbsp;
          </>
        )}
        {links.map((i) => (
          <span key={i}>
            <a href={href(i)} style={i === page ? { fontWeight: "bold", textDecoration: "underline" } : undefined}>
              {i}
            </a>
            &nbsp;&nbsp;
          </span>
        ))}
        {page < pages && (
          <>
            <a href={href(pages)}>Last</a>&nbsp;&nbsp;
          </>
        )}
      </td>
    </tr>
  );
}
