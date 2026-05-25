import { visit } from 'unist-util-visit';

/**
 * Rehype plugin: wraps katex-display spans with an alignment div.
 *
 * Usage in markdown (comment must be on its own line, before $$):
 *   <!-- left -->
 *   $$
 *   equation
 *   $$
 *
 * Supported values: left, right, center (center is already the default).
 *
 * Pipeline note: user rehype plugins run BEFORE rehype-raw in Astro, so HTML
 * comments are still `raw` HAST nodes (not yet parsed comment nodes) when this
 * plugin runs. We look for raw nodes matching <!-- left/right/center -->.
 */
export function rehypeMathAlign() {
  return (tree) => {
    const replacements = [];

    visit(tree, 'raw', (node, index, parent) => {
      if (!parent || index === null) return;

      const match = node.value?.trim().match(/^<!--\s*(left|right|center)\s*-->$/i);
      if (!match) return;

      // Find the next element sibling (skip other raw/text nodes).
      let nextIdx = index + 1;
      while (
        nextIdx < parent.children.length &&
        parent.children[nextIdx].type !== 'element'
      ) {
        nextIdx++;
      }

      const target = parent.children[nextIdx];
      if (!target) return;

      replacements.push({ parent, commentIdx: index, targetIdx: nextIdx, align: match[1].toLowerCase() });
    });

    // Apply in reverse order so indices stay valid.
    for (const { parent, commentIdx, targetIdx, align } of replacements.reverse()) {
      const target = parent.children[targetIdx];
      const wrapper = {
        type: 'element',
        tagName: 'div',
        properties: { className: [`math-align-${align}`] },
        children: [target],
      };
      // Remove nodes from commentIdx to targetIdx inclusive, insert wrapper.
      parent.children.splice(commentIdx, targetIdx - commentIdx + 1, wrapper);
    }
  };
}
