import {
  readerCommands,
  type ReaderShell,
} from "../src/guides/reader-commands";

const panel = document.getElementById("reader-builder");
if (panel) {
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const quote = document.getElementById(
    "reader-quote-link",
  ) as HTMLAnchorElement;
  const error = document.getElementById("reader-builder-error")!;
  const output = document.getElementById("reader-builder-output")!;
  const update = () => {
    try {
      const commands = readerCommands(
        panel.dataset.origin!,
        input("reader-url").value,
        input("reader-format").value,
        input("reader-limit").value,
        input("reader-shell").value as ReaderShell,
      );
      quote.href = commands.quoteUrl;
      document.getElementById("reader-quote-command")!.textContent =
        commands.quoteCommand;
      document.getElementById("reader-buy-command")!.textContent =
        commands.buyCommand;
      output.hidden = false;
      error.textContent = "";
    } catch (e) {
      output.hidden = true;
      quote.removeAttribute("href");
      document.getElementById("reader-quote-command")!.textContent = "";
      document.getElementById("reader-buy-command")!.textContent = "";
      error.textContent =
        e instanceof Error ? e.message : "Check the URL and options.";
    }
  };
  for (const id of [
    "reader-url",
    "reader-format",
    "reader-limit",
    "reader-shell",
  ])
    document.getElementById(id)!.addEventListener("input", update);
  for (const button of panel.querySelectorAll<HTMLButtonElement>(
    "button[data-copy]",
  ))
    button.addEventListener("click", async () => {
      const text = document.getElementById(button.dataset.copy!)!.textContent;
      if (!text || output.hidden) return;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select and copy the command below";
      }
    });
  update();
}
