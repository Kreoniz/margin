import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "unlikely-ui/tooltip";

type Hint = { label: string; shortcut?: string; context?: string };

/** One floating popup for all actions in a page or dialog. */
export function HintScope({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip.Provider delay={300} closeDelay={100}>
      <Tooltip.Root<Hint> disabled={disabled}>
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
  return (
    <Tooltip.Trigger
      payload={hint}
      disabled={children.props.disabled || children.props.loading}
      render={children}
    >
      {children.props.children}
    </Tooltip.Trigger>
  );
}
