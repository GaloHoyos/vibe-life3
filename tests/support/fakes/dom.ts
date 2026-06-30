export function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}
