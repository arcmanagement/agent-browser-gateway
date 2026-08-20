# Replay Policy

This policy defines the safety contract for `abg record` / `abg replay` before replay flows become
broader operational primitives. Replay must remain local, explicit, reviewable, and compatible with
ABG's per-tab consent and audit-log privacy model.

## Flow and Variable Syntax

Replay flow files are JSON documents with a top-level `steps` array. A step is the same operation
shape that `abg record` captures today, with optional placeholders in string fields.

Use double-brace placeholders:

| Syntax | Meaning |
|---|---|
| `{{var.name}}` | Non-secret user value. |
| `{{secret.name}}` | Secret user value. |
| `{{env.NAME}}` | Non-secret environment value. |

Names must match `[A-Za-z_][A-Za-z0-9_.-]*`. Placeholders are expanded only in JSON string values,
not in object keys, operation names, booleans, numbers, arrays, or command routing fields such as
`op`. A literal `{{` in a string must be escaped as `\{{`.

Flow files may include non-secret defaults under a top-level `variables` object:

```json
{
  "variables": {
    "var.ticket_id": {
      "description": "Ticket identifier",
      "default": "ABC-123"
    },
    "secret.api_token": {
      "description": "API token"
    }
  },
  "steps": [
    { "op": "fill", "selector": "#ticket", "value": "{{var.ticket_id}}" },
    { "op": "paste", "selector": "#token", "value": "{{secret.api_token}}" }
  ]
}
```

Secret variables must not have defaults. Secret placeholders are allowed only in fields that are
already handled as value payloads by the target operation, such as `value`, `text`, `html`, or
clipboard payload fields. They are not allowed in selectors, URLs, file paths, output paths,
redaction regexes, wait predicates, or JavaScript source.

## User-Provided Values

ABG stores replay metadata and user values separately.

| Value kind | Allowed sources | Storage rule |
|---|---|---|
| Non-secret variables | CLI flags, stdin JSON, environment, or a user-owned local values file | May be stored in an explicit local values file outside the flow file. |
| Secret variables | Interactive prompt, stdin JSON supplied for one replay invocation, or a future OS credential-store lookup | Must stay out of flow files and ABG-managed audit logs. By default ABG keeps them in process memory only for the current replay. |

A flow file is shareable only when it contains placeholders or non-secret defaults. It must not
contain bearer tokens, passwords, session cookies, private keys, one-time codes, recovery codes, or
other credential material.

If ABG later adds a first-class replay values file, it must live under the user's local ABG config
directory, be excluded from export commands by default, and document whether it is plaintext or
credential-store backed. Plaintext storage must reject `secret.*` entries.

## Dry-Run Output Scope

`abg replay <flow> --dry-run` is a preflight preview. It may resolve the target tab and parse the
flow, but it must not run browser operations, mutate the page, write cookies or storage, navigate,
capture screenshots, export HAR, write clipboard payloads, or create replay artifacts.

Dry-run output may include:

- target tab id/ref and match rule summary,
- step count and ordered operation names,
- selector, frame, URL match, timeout, and other non-secret routing metadata,
- names of required variables,
- whether each required variable is secret or non-secret,
- resolved byte lengths for supplied values,
- validation errors and unsupported placeholder locations.

Dry-run output must not include:

- raw values supplied for `{{var.*}}` or `{{secret.*}}`,
- clipboard payloads,
- form values,
- pasted text,
- replacement HTML/text,
- cookie or Web Storage values,
- request/response bodies,
- screenshot pixels or image paths created by replay.

## Audit Log and Artifact Boundaries

Replay uses the same Gateway operation path as direct CLI commands, so normal per-tab consent,
operation approval, and audit logging still apply. Replay must not create a bypass path around those
controls.

The following boundaries are mandatory:

- Audit logs may record the replay command, flow path or flow hash, step index, operation name,
  target tab, selector/routing metadata, approval result, error code, and value byte lengths.
- Audit logs must not record resolved variable values, secret names paired with values, clipboard
  payloads, pasted text, replacement HTML/text, raw plugin arguments, cookie values, Web Storage
  values, authorization headers, request bodies, response bodies, or unredacted before/after DOM.
- Flow files must store placeholders instead of user-provided secrets.
- Screenshots and PDFs are browser-state artifacts. A replay step that writes a `secret.*` value must
  not automatically capture or export a screenshot/PDF afterward unless the flow explicitly marks the
  capture step as user-approved and redaction-safe.
- Exported replay artifacts must exclude local values files, prompt transcripts, dry-run input JSON,
  audit-log raw details, screenshots, PDFs, HAR files, and any secret material by default.
- HAR and network artifacts created during a replay inherit the HAR policy: local-only, redacted by
  default, with headers and bodies omitted unless a separate explicit feature allows bounded preview.

If a requested replay behavior would require storing secrets in an audit log, flow file, screenshot,
or exported replay bundle, the implementation must fail closed with a stable error instead of
silently redacting after persistence.

## Implementation Checklist

Any PR that implements or extends replay variables must state:

- supported placeholder syntax and unsupported fields,
- how user values are supplied,
- where non-secret values are stored,
- how secret values avoid flow files and audit logs,
- dry-run output fields,
- export behavior for values and replay-generated artifacts,
- failure behavior for unsupported secret placement.
