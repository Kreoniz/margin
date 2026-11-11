import { createContext, useContext, useRef, type ReactElement, type ReactNode } from "react";
import { Tooltip } from "unlikely-ui/tooltip";

type Hint = { label: string; shortcut?: string; context?: string };
const RestartHover = createContext(() => {});

/** One floating popup for all actions in a page or dialog. */
export function HintScope({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const actions = useRef<{ close: () => void; unmount: () => void } | null>(null);
  return (
    <Tooltip.Provider delay={400} closeDelay={100}>
      <RestartHover
        value={() => {
          // A shared root can otherwise transfer/reopen immediately. End its
          // previous hover before this trigger's native dwell timer starts.
          actions.current?.close();
          actions.current?.unmount();
        }}
      >
        <Tooltip.Root<Hint> disabled={disabled} actionsRef={actions}>
          {({ payload }) => (
            <>
              {children}
              <Tooltip.Content className="action-hint">
                {payload && (
                  <>
                    <span>{payload.label}</span>
                    {payload.shortcut && <kbd>{payload.shortcut}</kbd>}
                    {payload.context && <small>{payload.context}</small>}
                  </>
                )}
              </Tooltip.Content>
            </>
          )}
        </Tooltip.Root>
      </RestartHover>
    </Tooltip.Provider>
  );
}

export function ActionHint({
  children,
  ...hint
}: Hint & {
  children: ReactElement<{
    children?: ReactNode;
    disabled?: boolean;
    loading?: boolean;
  }>;
}) {
  const restartHover = useContext(RestartHover);
  return (
    <Tooltip.Trigger
      onPointerOverCapture={(event) => {
        if (
          event.pointerType === "mouse" &&
          !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        ) restartHover();
      }}
      payload={hint}
      disabled={children.props.disabled || children.props.loading}
      render={children}
    >
      {children.props.children}
    </Tooltip.Trigger>
  );
}
