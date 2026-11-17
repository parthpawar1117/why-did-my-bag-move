import { Explainer } from "@/web/components/Explainer";

export default function Home() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Built on the CoinMarketCap API</p>
        <h1>Why did my bag move?</h1>
        <p className="lede">
          Paste your holdings. See how much of today&apos;s move came from <strong>the whole market</strong>, from{" "}
          <strong>your coins&apos; sectors</strong>, and from <strong>news specific to your coins</strong>, with every number
          linked to the CoinMarketCap call it came from.
        </p>
      </header>
      <Explainer />
      <footer className="footer">
        <p>
          Data: CoinMarketCap API (quotes, global metrics, 30-day history, categories, Fear &amp; Greed, liquidations). Figures
          cover the last 24 hours. Not financial advice.
        </p>
        <p>
          <a href="https://github.com/parthpawar1117/why-did-my-bag-move">Source code on GitHub</a> · Also available as an MCP
          server for AI assistants.
        </p>
      </footer>
    </main>
  );
}
