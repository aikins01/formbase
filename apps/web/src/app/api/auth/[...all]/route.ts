import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@formbase/auth';

export const { GET, POST } = toNextJsHandler(auth);
