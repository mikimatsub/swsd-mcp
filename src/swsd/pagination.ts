export interface PaginationMeta {
  page: number;
  per_page: number;
  total?: number;
  has_more: boolean;
  next_page?: number;
}

/** Keep upstream counts separate from matches after local filtering. */
export function withTotalScope(
  pagination: PaginationMeta,
  clientFilterApplied: boolean,
  hasServerFilter: boolean,
  matches: number,
  allPagesScanned = pagination.page === 1 && !pagination.has_more,
): PaginationMeta & { total_scope: 'upstream' | 'filtered' | 'tenant' | 'unknown'; matched_total: number | null } {
  return {
    ...pagination,
    total_scope: pagination.total === undefined ? 'unknown'
      : clientFilterApplied ? 'upstream' : hasServerFilter ? 'filtered' : 'tenant',
    matched_total: allPagesScanned ? matches : clientFilterApplied ? null : pagination.total ?? null,
  };
}

const LINK_PART_RE = /<([^>]+)>;\s*rel="?([^"]+)"?/;
const PAGE_PARAM_RE = /[?&]page=(\d+)/;

/**
 * Parse RFC 5988 Link header into a rel→url map.
 * Example: <...?page=2>; rel="next", <...?page=10>; rel="last"
 */
export function parseLinkHeader(header: string | null | undefined): Map<string, string> {
  const links = new Map<string, string>();
  if (!header) return links;
  for (const part of header.split(',')) {
    const match = part.trim().match(LINK_PART_RE);
    if (match && match[1] && match[2]) {
      links.set(match[2], match[1]);
    }
  }
  return links;
}

export function extractPagination(
  responseHeaders: Headers,
  page: number,
  perPage: number,
  bodyLength: number,
): PaginationMeta {
  const totalRaw = responseHeaders.get('x-total-count') ?? responseHeaders.get('x-total');
  const total =
    totalRaw !== null && totalRaw !== '' && !Number.isNaN(Number(totalRaw))
      ? Number(totalRaw)
      : undefined;

  const links = parseLinkHeader(responseHeaders.get('link'));
  const hasNextLink = links.has('next');

  let has_more: boolean;
  if (hasNextLink) {
    has_more = true;
  } else if (total !== undefined) {
    has_more = page * perPage < total;
  } else {
    // A full page suggests more results; a short page is the end.
    has_more = bodyLength >= perPage;
  }

  let next_page: number | undefined;
  if (hasNextLink) {
    const nextUrl = links.get('next');
    if (nextUrl) {
      const m = nextUrl.match(PAGE_PARAM_RE);
      if (m && m[1]) next_page = Number(m[1]);
    }
  }
  if (next_page === undefined && has_more) {
    next_page = page + 1;
  }

  return { page, per_page: perPage, total, has_more, next_page };
}
