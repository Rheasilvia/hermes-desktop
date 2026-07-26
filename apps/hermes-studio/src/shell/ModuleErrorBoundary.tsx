import type { Component, JSX } from 'solid-js';
import { ErrorBoundary } from 'solid-js';
import { ModuleErrorFallback } from './ModuleErrorFallback.js';

interface ModuleErrorBoundaryProps {
  moduleName: string;
  children: JSX.Element;
}

export const ModuleErrorBoundary: Component<ModuleErrorBoundaryProps> = (props) => {
  return (
    <ErrorBoundary fallback={(err: Error, reset: () => void) => (
      <ModuleErrorFallback
        moduleName={props.moduleName}
        error={err}
        onReload={reset}
      />
    )}>
      {props.children}
    </ErrorBoundary>
  );
};
