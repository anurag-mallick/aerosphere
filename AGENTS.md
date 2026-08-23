# AeroSphere — Agent Working Rules

## 1 · Always update the installed application
After any feature work is merged to `main`, **rebuild the local application** so the
user's installed copy stays current:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run build && npx electron-builder --mac dir
```

Output: `release/mac-arm64/AeroSphere.app`. The user launches via
`AeroSphere.command`, which opens this bundle automatically.

Never leave a stale build behind: if code changed, rebuild before finishing.

## 2 · Verification before done
- `npm run typecheck`
- `npm test`
- `npm run build`
- For UI changes: launch the app and verify through the real DOM (CDP), not by
  reading source or calling backend handlers directly.

## 3 · Git hygiene
- Demo/user media never enters git (`Demo video/`, `*.insv`, `*.lrv` are ignored).
- One logical change per commit; push to `origin main` after verification.
