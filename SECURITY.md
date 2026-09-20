# Security Policy

## Supported versions

Security fixes are applied to the current default branch and, when releases exist, the latest tagged release. Older snapshots are not maintained as separate supported versions.

## Reporting a vulnerability

Do not open a public issue, discussion, or pull request for a suspected security vulnerability.

Use GitHub Private vulnerability reporting from the repository Security area. This provides a private channel for sharing details with the maintainer before public disclosure. If the private reporting control is temporarily unavailable, contact the maintainer through the GitHub profile and request a private reporting channel without including exploit details in a public message.

Include enough information to reproduce and assess the issue:

- affected URL, file, dependency, or workflow;
- security impact and realistic attack conditions;
- minimal reproduction steps or proof of concept;
- relevant browser, operating system, and version details;
- suggested mitigation when known.

Do not include credentials, access tokens, private keys, personal data, or unrelated sensitive information.

## Scope

US Systems Lab is designed as a static, client-side application. It does not intentionally require a server-side API, authentication service, database, or runtime application secrets.

Security reports can include, among other issues, cross-site scripting, unsafe URL handling, dependency or build-pipeline compromise, workflow injection, credential exposure, or a static-hosting configuration that creates an exploitable condition.

Disagreements about modeled relationships, source interpretation, or policy assumptions are not security vulnerabilities unless they also create a concrete security impact. Use the normal issue templates for those topics.

## Disclosure

Please allow time for validation and remediation before publishing exploit details. The maintainer will coordinate disclosure after a fix or mitigation is available when practical.
