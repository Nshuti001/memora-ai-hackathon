# Diagram source

`architecture.png` in the repo root is generated from `architecture.mmd`, so it can be regenerated
rather than hand-edited:

```bash
npx -y @mermaid-js/mermaid-cli -i docs/architecture.mmd -o architecture.png \
  -c docs/architecture-theme.json -b white -w 1500
```

It is kept separate from the Mermaid block in the top-level README: that one renders inline on
GitHub, while this one is laid out for a standalone image (Devpost's architecture upload, slides).
