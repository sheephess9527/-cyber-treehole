# 🕳️ Cyber Treehole (-网络树洞)

A modern, secure, and lightweight anonymous social platform built on a full-stack Serverless architecture. This project provides a turnkey solution for developers and grassroots communities to deploy their own privacy-focused micro-sharing spaces with zero hosting costs.

## 🚀 Architecture & Tech Stack

Unlike traditional web applications that require heavy servers, this project is engineered entirely on the cutting-edge cloud infrastructure:

*   **Frontend:** Pure HTML5 / CSS3 single-page architecture—ultra-lightweight, zero-dependency, and fully responsive across mobile and desktop devices.
*   **Edge Computing:** Powered by **Cloudflare Workers**, executing backend API logic at edge locations closest to users for blistering-fast response times.
*   **Database:** Utilizing **Cloudflare D1**, a native serverless SQL relational database, ensuring secure, structured, and compliant data persistence.

## ✨ Core Features

*   **Immersive Entrance:** A well-crafted, ritualistic welcome sequence that sets a serene mood before entering the anonymous space.
*   **Shouting Wall & Public Records:** Allows users to publish thoughts anonymously to a public timeline, creating a shared community chronicle.
*   **Photo & Feedback Logs:** Supports uploading local images paired with rich text reflections, fully rendered without relying on complex external asset paths.
*   **Private Inbox Display:** A dedicated interface for publicly displaying mailbox messages and community responses.
*   **Data Portability:** Seamless **JSON Export / Import** utility, giving users full ownership and easy backups of their platform data.
*   **Strict Privacy:** No tracking scripts, no heavy frameworks, and complete respect for user data anonymity.

## 🛠️ Project Structure

```text
├── Functions/ API/       # Serverless API routes for Cloudflare Workers
├── index.html            # Main responsive frontend single-page
├── schema.sql            # Relational database table definitions for Cloudflare D1
├── worker.js             # Core Edge routing and backend controller logic
├── wrangler.jsonc        # Cloudflare Wrangler infrastructure configuration
└── 部署.md               # Detailed deployment handbook (Chinese)
