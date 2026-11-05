import Link from "next/link";
export default function TermsPage() {
  return (
    <main className="legal-document">
      <p>CONTENT STUDIO</p>
      <h1>Terms of service</h1>
      <p>Last updated: 5 November 2026</p>
      <p>
        Content Studio is a private workspace provided by its operator for
        planning content and tracking the performance of accounts you are
        authorized to manage. Access is limited to people authorized by that
        operator.
      </p>
      <h2>Your accounts and content</h2>
      <p>
        Connect only accounts and spreadsheets that you own or are permitted to
        manage. You remain responsible for your content, permissions and
        compliance with the connected platforms&apos; terms. Do not share
        credentials or use the app to access another person&apos;s private data
        without permission.
      </p>
      <h2>Performance data and changes</h2>
      <p>
        Sync runs when you request it. Available provider metrics can update
        that platform&apos;s snapshot for the current date, including manually
        entered metrics. Previous values are retained in correction history.
        Metrics may be delayed, unavailable, revised or measured differently by
        each platform. Review the results and keep your own spreadsheet backups
        before relying on the data.
      </p>
      <h2>Availability</h2>
      <p>
        Provider approval, access limits, permissions and service availability
        can affect the integration. Connections may expire or require
        authorization again. The app does not guarantee continuous availability,
        complete analytics or compatibility with future provider changes.
      </p>
      <h2>Ending access and support</h2>
      <p>
        You may stop using the app and revoke connected permissions through the
        provider. Saved tracker records are separate from provider authorization
        and remain until removed. For support, access changes or deletion
        requests, contact the operator who provided your access to this private
        workspace.
      </p>
      <nav>
        <Link href="/privacy">Privacy policy</Link> ·{" "}
        <Link href="/settings">Return to Content Studio</Link>
      </nav>
    </main>
  );
}
