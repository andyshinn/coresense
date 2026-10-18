import type { ApiClient } from '../../src/renderer/lib/api';

/** A renderer API client for tests whose api module is mocked: nothing is ever
 *  fetched from it, it only has to be passed through. */
export const TEST_CLIENT: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
