import Link from "next/link";
export default function PrivacyPage() {
  return (
    <main className="legal-document">
      <p>CONTENT STUDIO</p>
      <h1>Privacy policy</h1>
      <p>Last updated: 5 November 2026</p>
      <p>
        Content Studio is a private creator workspace for planning content and
        tracking performance. This page describes the information used by the
        application.
      </p>
      <h2>Information used</h2>
      <p>
        When you connect Google, Instagram or TikTok, the application uses the
        account identity and permissions needed to access your chosen tracker or
        your own social posts. Manual Sync reads available video performance
        counts, such as views, likes, comments and shares. The integration does
        not request permission to publish videos or send messages.
      </p>
      <h2>Storage and use</h2>
      <p>
        Content records and performance snapshots are stored in the Google
        spreadsheet configured by the workspace owner. Prior values can remain
        in correction history. Connection tokens are encrypted on the server in
        a private Vercel Blob store. Server configuration credentials are held
        in the deployment environment. Tokens are not stored in the spreadsheet
        or browser storage.
      </p>
      <p>
        The browser can keep workspace content for offline reading, demo data
        and display preferences. Signing out removes the offline workspace
        cache; Settings also provides Clear offline content. Use a trusted
        device and clear locally stored content before sharing it.
      </p>
      <h2>Services involved</h2>
      <p>
        The app communicates with Google, Meta and TikTok when you authorize
        access or request their data. Vercel hosts the app and connection
        storage. These services process requests under their own policies. The
        app does not sell your workspace or social account data.
      </p>
      <h2>Retention, access and deletion</h2>
      <p>
        Workspace records and correction history remain until the workspace
        owner removes them. Connection credentials remain on the server until
        replaced or removed by the operator; access can also expire or be
        revoked by the provider. Revoking access does not delete snapshots
        already saved in your tracker.
      </p>
      <p>
        You can revoke access in the connected provider&apos;s account settings
        and manage records in your own tracker. For privacy questions or
        deletion of server connection credentials, contact the person who
        operates this private workspace and provided your access. The operator
        must remove the stored connection and deployment credentials when
        processing such a request.
      </p>
      <nav>
        <Link href="/terms">Terms of service</Link> ·{" "}
        <Link href="/settings">Return to Content Studio</Link>
      </nav>
    </main>
  );
}
