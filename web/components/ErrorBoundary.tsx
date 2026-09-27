/**
 * Last-resort safety net around the whole app. Without this, any uncaught render exception
 * (most commonly: reconnecting into a room whose GameState a deploy made incompatible with
 * the current client) unmounts the entire React tree, which reads to the player as a plain
 * black screen with no explanation and no way back short of manually clearing browser data.
 * This catches that, shows a real message, and offers a recovery action that forgets the
 * saved reconnect token (the thing most likely to walk straight back into the same crash)
 * before reloading.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { clearSavedOnlineSession } from "../useSession.js";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Prospector crashed:", error, info.componentStack);
  }

  private recover = (): void => {
    clearSavedOnlineSession();
    location.reload();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen">
        <h1>Something went wrong</h1>
        <p>
          The app hit an unexpected error and can&apos;t continue. This can happen after an
          update if your browser was mid-way through an old game.
        </p>
        <button type="button" onClick={this.recover}>
          Reload
        </button>
        <pre className="crash-detail">{String(this.state.error?.message ?? this.state.error)}</pre>
      </div>
    );
  }
}
