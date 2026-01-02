```dataviewjs
const plugin = app.plugins.plugins["creation-ledger"];

if (!plugin || !plugin.constants) {
  dv.paragraph("Creation Ledger plugin is not available.");
} else {
  const {
    ROOT_FOLDER,
    TAG_PREFIX
  } = plugin.constants;

  const allPages = dv.pages(`"${ROOT_FOLDER}"`);
  const tagsMap = new Map();

  allPages.forEach(page => {
    const tags = (page.file.tags || []).filter(t => t.startsWith(TAG_PREFIX));
    tags.forEach(tag => {
      const count = tagsMap.get(tag) || 0;
      tagsMap.set(tag, count + 1);
    });
  });

  const tagRows = Array.from(tagsMap.entries())
    .map(([tag, count]) => {
      // Ensure tag has # prefix for clickable link
      const tagLink = tag.startsWith('#') ? tag : `#${tag}`;
      return [tagLink, count];
    })
    .sort((a, b) => b[1] - a[1]);

  dv.table(["Tag", "Notes"], tagRows);
}
```
