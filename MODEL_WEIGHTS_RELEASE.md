# FreshWise model weights

The FreshWise Qwen3-VL 4B model weights are stored as GitHub Release assets, not in normal Git history.

Release:

https://github.com/wwan0255/fresh-wise-bytebite-tm05/releases/tag/freshwise-qwen3-vl-4b-weights-20260913

Why a release asset instead of a normal commit:

- The base model is about 8.3 GB.
- Normal GitHub files are not suitable for multi-GB model weights.
- Keeping weights out of Git history makes the source repository faster to clone.
- No API keys or runtime secrets are included in the model release.

Restore locally:

1. Download every asset from the release into one folder.
2. Open PowerShell in that folder.
3. Run:

```powershell
.\restore_freshwise_model_weights.ps1 `
  -ManifestPath .\freshwise-qwen3-vl-4b-weights-manifest.json `
  -OutputRoot .\models
```

The restored model directory will contain:

- `models/Qwen3-VL-4B-Instruct/`
- `models/adapters/qwen3_vl_4b_frozen_research_v1/`
