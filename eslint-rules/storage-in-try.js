// localStorage/sessionStorage can throw (private mode, blocked site data): only touch them inside a try block.
module.exports = {
  meta: { type: "problem", schema: [], messages: { bare: "{{name}} must be used inside a try block (it can throw)." } },
  create(context) {
    return {
      Identifier(node) {
        if (node.name !== "localStorage" && node.name !== "sessionStorage") return;
        const p = node.parent;
        if (p.type === "Property" && p.key === node && !p.computed) return; // { localStorage: ... } key, not a use
        if (p.type === "MemberExpression" && p.property === node && !p.computed) return; // x.localStorage
        const chain = [...context.sourceCode.getAncestors(node), node];
        const ok = chain.some((a, i) => a.type === "TryStatement" && a.block === chain[i + 1]);
        if (!ok) context.report({ node, messageId: "bare", data: { name: node.name } });
      },
    };
  },
};
