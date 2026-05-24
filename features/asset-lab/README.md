# TidyDesk Asset Lab

Asset Lab is an isolated feature island for quick web asset preparation. It is intentionally not wired into the current Electron main process or rail UI yet.

## Product shape

- Drop or paste an image.
- Generate a small preset set immediately.
- Drag, copy, reveal, or save the generated files.
- Keep the workflow local and short enough for front-end/site work.

## Layers

```text
features/asset-lab/
  contracts/       Shared TypeScript request, response, and preset types.
  renderer/        React panel component for the future floating window.
  electron/        Thin bridge shape for future IPC integration.
  native/          Go worker for image processing.
```

## Current worker support

The Go worker currently supports:

- Center cover crop
- Contain with background fill
- Stretch resize
- PNG output
- JPEG output
- PNG-in-ICO output with multiple sizes

WebP is kept in the TypeScript contract and preset model, but the encoder is not bundled in this isolated worker yet. Add it behind the Go encoder boundary instead of leaking image-library details into Electron or React.

## Future integration points

- Rail button opens an independent Asset Lab floating window.
- Preload exposes a small `tidyDesk.assetLab` bridge.
- Electron service stages clipboard/sticker/drop inputs into temp files.
- Main process calls the Go worker with a JSON request and returns JSON output.
- Result cards use Electron drag-out support when moving generated files into desktop, VS Code, or upload fields.

