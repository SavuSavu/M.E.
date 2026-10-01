/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// M.E. adaptation: Vite bundles Three.js for both page and workers.
// Resolve locally; no runtime CDN fallback or top-level await is needed.
import * as THREE from 'three';
export { THREE };
