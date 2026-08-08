# Third-party UI foundations

The do-code terminal UI uses the Gemini CLI Ink architecture as its primary
reference and depends on the Gemini-maintained Ink fork published as
`@jrichman/ink`.

- Gemini CLI: Copyright Google LLC, Apache License 2.0
- `@jrichman/ink`: Ink terminal renderer fork used by Gemini CLI

The do-code implementation is maintained in this repository. Its inline
history and composer design intentionally follow Gemini CLI's default
architectural boundaries so there is only one terminal UI stack to support.
