import { visit } from 'unist-util-visit';

/**
 * Remark plugin: <!-- left --> or <!-- right --> before a $$ block sets alignment.
 *
 * Usage in markdown:
 *   <!-- left -->
 *   $$
 *   equation
 *   $$
 *
 * Obsidian treats HTML comments as invisible, so the comment is hidden there.
 * On the web, the comment node is removed and a CSS class is added to the math wrapper.
 */
export function remarkMathAlign() {
  return (tree) => {
    const toRemove = [];

    visit(tree, 'math', (node, index, parent) => {
      if (!parent || index === null || index === 0) return;

      const prev = parent.children[index - 1];
      if (prev?.type !== 'html') return;

      const match = prev.value.trim().match(/^<!--\s*(left|center|right)\s*-->$/i);
      if (!match) return;

      const align = match[1].toLowerCase();
      node.data = node.data || {};

      // Merge into existing hProperties so remark-math's own classes are preserved.
      const existing = node.data.hProperties?.className;
      const existingClasses = Array.isArray(existing) ? existing : existing ? [existing] : [];
      node.data.hProperties = {
        ...(node.data.hProperties || {}),
        className: [...existingClasses, `math-align-${align}`],
      };

      toRemove.push({ parent, index: index - 1 });
    });

    // Remove in reverse order so earlier indices stay valid.
    for (const { parent, index } of toRemove.reverse()) {
      parent.children.splice(index, 1);
    }
  };
}
