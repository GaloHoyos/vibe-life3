export function mount(): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}
