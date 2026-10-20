/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: registerRoot, REMOTION_ENTRY, remotion studio,
 *   remotion render
 *
 * WHAT:  The Remotion entry point — the file the studio and the CLI load.
 * WHY:   REMOTION_ENTRY. It does one thing and must keep doing only that:
 *        `registerRoot` has to be the single side effect of importing this
 *        file, because Remotion imports it in a bare bundle with no Next
 *        runtime, no environment variables and no server. Anything else here
 *        — a config read, a database import — fails at bundle time with an
 *        error that names Remotion rather than the import that caused it.
 *
 *        This is NOT the preview page's path. The Player mounts
 *        TimelineRenderer directly (see the preview component), so the app
 *        never loads this module and the CLI never loads the app.
 * WHERE: `npm run remotion:studio` and `npm run remotion:render`, both of
 *        which name this file explicitly.
 */

import { registerRoot } from 'remotion'

import { RemotionRoot } from './root'

registerRoot(RemotionRoot)
