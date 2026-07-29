# Vendored MeshCore firmware sources

These are read-only copies of upstream firmware, kept so that design and
implementation work can cite firmware behaviour precisely instead of inferring it
from documentation. **Nothing here is compiled, linted, or imported.** Do not edit
them; re-vendor instead.

Upstream: <https://github.com/meshcore-dev/MeshCore>

| Local file | Upstream path | Commit | Notes |
|---|---|---|---|
| `CommonCLI.cpp` | `src/helpers/CommonCLI.cpp` | `03b6ef4b0de98fc70b49ef10a6d0d61f8381fb7a` | Vendored 2026-07-28. The shared CLI dispatcher — the authority for the repeater command grammar. |
| `MyMeshRepeater.cpp` | `examples/simple_repeater/MyMesh.cpp` | unrecorded, predates `03b6ef4` | Renamed locally to disambiguate from the companion file. 1310 lines vs 1316 upstream at `03b6ef4`. |
| `MyMesh.cpp` | `examples/companion_radio/MyMesh.cpp` | unrecorded, predates `03b6ef4` | The **companion node's** serial rescue CLI (`set pin`, `rebuild`, `erase`, `ls`, `cat`, `rm`, `reboot`) — a different grammar from the repeater's. Do not mine it as a repeater command catalog. |

## Why the repeater file is split from the dispatcher

`MyMeshRepeater.cpp` handles only three commands locally — `setperm`, `get acl`, and
`discover.neighbors` — and forwards everything else to `_cli.handleCommand()`, which
lives in `CommonCLI.cpp`. Any claim about a repeater command that is not one of those
three has to be checked against `CommonCLI.cpp`.

## Re-vendoring

```sh
SHA=<commit>
curl -sf "https://raw.githubusercontent.com/meshcore-dev/MeshCore/$SHA/src/helpers/CommonCLI.cpp" \
  -o docs/firmware/CommonCLI.cpp
curl -sf "https://raw.githubusercontent.com/meshcore-dev/MeshCore/$SHA/examples/simple_repeater/MyMesh.cpp" \
  -o docs/firmware/MyMeshRepeater.cpp
curl -sf "https://raw.githubusercontent.com/meshcore-dev/MeshCore/$SHA/examples/companion_radio/MyMesh.cpp" \
  -o docs/firmware/MyMesh.cpp
```

Update the table above when you do. Line citations in
`docs/superpowers/specs/2026-07-28-repeater-cli-autocomplete-design.md` are against the
copies recorded here, so re-vendoring the two example files will shift them.
