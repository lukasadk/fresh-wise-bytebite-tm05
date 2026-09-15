# FreshWise AI model

This folder is the source-control entry point for the FreshWise AI model assets.

The model weights themselves are **not committed into normal Git history** because the 4B model is about 8.3 GB and includes files far above GitHub's normal file-size limits. Keeping the weights in Git would make the team repository slow to clone and easy to break.

Current model release assets:

https://github.com/wwan0255/fresh-wise-bytebite-tm05/releases/tag/freshwise-qwen3-vl-4b-weights-20260913

Included model directories after restore:

- `Qwen3-VL-4B-Instruct/`
- `adapters/qwen3_vl_4b_frozen_research_v1/`

## Restore locally

From this folder, run:

```powershell
.\download-release-assets.ps1
```

That script downloads the release assets into:

- `ai model/downloads/`

and restores the model into:

- `ai model/models/`

Both folders are ignored by Git so model weights are not accidentally pushed.

## Notes for teammates

- No API keys are stored here.
- The app currently uses the hosted API path for recognition; these local weights are only needed if you are working on local/offline model experiments.
- If the team later moves the model release from `wwan0255` to `lukasadk`, update the `Owner` parameter in `download-release-assets.ps1`.
