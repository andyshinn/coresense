import type { ApiClient } from '../../lib/api';

/** Props every settings section component takes. */
export interface SectionProps {
  client: ApiClient | null;
}
