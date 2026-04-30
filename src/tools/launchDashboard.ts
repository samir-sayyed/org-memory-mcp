import net from 'net';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

export const LAUNCH_DASHBOARD_TOOL_NAME = 'launch_dashboard';

const PORT = 3001;
const DASHBOARD_URL = `http://localhost:${PORT}`;

export function launchDashboardTool() {
  return {
    name: LAUNCH_DASHBOARD_TOOL_NAME,
    description:
      'Launch the Org Memory visual dashboard in your browser. ' +
      'Opens a local web UI at http://localhost:3001 showing all your memories as cards, ' +
      'with scope filters, search, charts (scope distribution, creation timeline), and a word cloud. ' +
      'Safe to call multiple times — if the dashboard is already running, returns the URL immediately.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleLaunchDashboard(
  _args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const alreadyRunning = await isPortInUse(PORT);

    if (alreadyRunning) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'already_running',
                url: DASHBOARD_URL,
                message: 'Dashboard is already running. Open the URL in your browser.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Resolve the visualize script path relative to this file.
    // Works both in dev (src/tools/) and production (build/tools/).
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const visualizeScript = path.resolve(__dirname, '..', 'visualize.js');
    const dashboardHtml = path.resolve(__dirname, '..', 'visualizer', 'index.html');

    if (!fs.existsSync(visualizeScript) || !fs.existsSync(dashboardHtml)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'error',
                message:
                  'Dashboard build artifacts are missing. Run "npm run build" first, or use "npm run visualize" for the source-based local dashboard.',
                visualizeScript,
                dashboardHtml,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const child = spawn(process.execPath, [visualizeScript], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();

    // Give the server a moment to bind the port
    await sleep(800);

    const started = await isPortInUse(PORT);
    if (!started) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'error',
                message: `Dashboard server did not start on port ${PORT} in time. Try running 'npm run visualize' manually.`,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'started',
              url: DASHBOARD_URL,
              message: 'Dashboard launched! Opening http://localhost:3001 — use Refresh to reload data.',
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error launching dashboard: ${error.message}` }],
      isError: true,
    };
  }
}
