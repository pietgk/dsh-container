# Evaluation evidence policy

Every reported result must name the strongest evidence class it actually
satisfies. A lower class never inherits the claims of a higher class.

| Class | What it proves | What it does not prove |
| --- | --- | --- |
| `functional` | CLI, API, protocol, persistence, and model behavior | Rendered layout or browser interaction |
| `visual-automated` | Playwright assertions and screenshots passed | Human exploratory judgement |
| `interactive` | Official in-app Browser or connected Chrome completed the flow | Repeatability unless an automated test also exists |
| `diagnostic` | A separately approved driver inspected the page | Official Browser availability |
| `human-confirmed` | A named result was manually observed | Automated repeatability |
| `blocked` | A required capability was unavailable | Any substitute success |

The Web host API is a valid functional driver. It must not be described as a
visual driver. `chrome-devtools-axi` is useful diagnostic evidence, but it does
not become official Browser evidence. Human confirmation supplements rather
than silently upgrades an automated result.

## Required record

Each evaluation records the target URL, DSH revision, manager revision,
instance name, evidence class, driver, scenario, result, sanitized artifact
paths, and any limitation. Credentials and complete transcripts are excluded.
