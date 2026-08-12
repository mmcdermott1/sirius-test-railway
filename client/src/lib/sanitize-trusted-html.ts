import DOMPurify from "isomorphic-dompurify";

/**
 * Shared allowlist sanitizer for admin-authored "trusted" HTML content
 * (login page intro, welcome messages, etc.). Applied wherever such
 * content is rendered via dangerouslySetInnerHTML — both public pages
 * and admin previews — so raw-editor/API submissions can't execute.
 */
export function sanitizeTrustedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'div'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  });
}
