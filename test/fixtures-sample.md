# Calmdown sample

A quick file to try the viewer. Footnotes work too[^1], and so do task lists and tables.

## Section one

Some text with `inline code`, a [link](https://example.com), and a second paragraph.

### Nested heading

- [ ] open this file in the viewer
- [x] see the index on the left

## Section two

| Feature | Phase |
| --- | --- |
| Index | 1 |
| Collapse | 2 |

```js
console.log('hello');
```

## Hostile content (should render inert)

<img src=x onerror="alert(1)">

[bad link](javascript:alert(1))

[^1]: Footnote popovers arrive in Phase 2.
