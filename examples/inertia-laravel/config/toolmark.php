<?php

return [
    // Serve the e2e bundle (`vite build --mode e2e`, with the test hook) from public/build-e2e.
    // Honoured only in the `local` and `testing` environments (AppServiceProvider).
    'e2e_build' => (bool) env('TOOLMARK_E2E_BUILD', false),
];
