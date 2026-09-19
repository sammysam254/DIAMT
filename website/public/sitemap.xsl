<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" 
                xmlns:html="http://www.w3.org/TR/REC-html40"
                xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <title>XML Sitemap — DIAMT Cloud Platform</title>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #0b132b;
            color: #f8fafc;
            margin: 0;
            padding: 40px 24px;
          }
          .container {
            max-width: 900px;
            margin: 0 auto;
            background: rgba(15, 23, 42, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 32px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
          }
          h1 {
            font-size: 24px;
            font-weight: 800;
            margin-top: 0;
            color: #38bdf8;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          p {
            color: #94a3b8;
            font-size: 14px;
            line-height: 1.5;
            margin-bottom: 24px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 14px;
          }
          th {
            padding: 12px 16px;
            border-bottom: 2px solid rgba(255, 255, 255, 0.1);
            color: #64748b;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          td {
            padding: 14px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          }
          a {
            color: #38bdf8;
            text-decoration: none;
            font-weight: 600;
          }
          a:hover {
            text-decoration: underline;
          }
          .badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 700;
            background: rgba(56, 189, 248, 0.15);
            color: #38bdf8;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚡ XML Sitemap Index</h1>
          <p>This XML sitemap lists public URLs available for search engine indexing on DIAMT Cloud.</p>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Priority</th>
                <th>Change Frequency</th>
                <th>Last Modified</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sitemap:urlset/sitemap:url">
                <tr>
                  <td>
                    <a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a>
                  </td>
                  <td>
                    <span class="badge"><xsl:value-of select="sitemap:priority"/></span>
                  </td>
                  <td style="color: #94a3b8;"><xsl:value-of select="sitemap:changefreq"/></td>
                  <td style="color: #64748b;"><xsl:value-of select="sitemap:lastmod"/></td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
