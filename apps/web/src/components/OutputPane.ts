// apps/web/src/components/OutputPane.ts

export class OutputPane {
  private doc: any;
  private container: HTMLElement;
  private outputEl: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  constructor(doc: any) {
    this.doc = doc;
    this.container = document.createElement("div");
    this.container.className = "output-pane";
  }

  mount(el: HTMLElement): void {
    this.outputEl = document.createElement("div");
    this.outputEl.className = "output-content";
    this.outputEl.innerHTML = "<pre class=\"output-placeholder\">Waiting for generation...</pre>";
    this.container.appendChild(this.outputEl);
    el.appendChild(this.container);

    // Subscribe to output Y.Text changes
    const render = () => {
      const text = this.doc.output.toString();
      this.outputEl.innerHTML = `<pre>${text}</pre>`;
    };
    this.doc.output.observe(render);
    this.unsubscribe = () => this.doc.output.unobserve(render);
  }

  destroy(): void {
    this.unsubscribe?.();
  }
}
