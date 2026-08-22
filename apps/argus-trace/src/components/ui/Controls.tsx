import { Button } from "@base-ui/react/button";
import { Progress } from "@base-ui/react/progress";
import { Select } from "@base-ui/react/select";
import { Slider } from "@base-ui/react/slider";
import { Toast } from "@base-ui/react/toast";
import { Tooltip } from "@base-ui/react/tooltip";
import { Check, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

export interface UiOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface UiSelectProps {
  label: string;
  value: string;
  options: UiOption[];
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export function UiSelect({ label, value, options, onValueChange, className = "", disabled = false }: UiSelectProps) {
  return (
    <div className={`ui-field ${className}`.trim()}>
      <Select.Root
        value={value}
        items={options}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next);
        }}
      >
        <Select.Label className="ui-field-label">{label}</Select.Label>
        <Select.Trigger className="ui-select-trigger">
          <Select.Value className="ui-select-value" />
          <Select.Icon className="ui-select-icon"><ChevronsUpDown size={14} aria-hidden="true" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="ui-select-positioner" sideOffset={4}>
            <Select.Popup className="ui-select-popup">
              <Select.ScrollUpArrow className="ui-select-scroll"><ChevronUp size={14} aria-hidden="true" /></Select.ScrollUpArrow>
              <Select.List className="ui-select-list">
                {options.map((option) => (
                  <Select.Item className="ui-select-item" key={option.value} value={option.value} disabled={option.disabled}>
                    <Select.ItemIndicator className="ui-select-check"><Check size={14} aria-hidden="true" /></Select.ItemIndicator>
                    <Select.ItemText className="ui-select-item-text">{option.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
              <Select.ScrollDownArrow className="ui-select-scroll"><ChevronDown size={14} aria-hidden="true" /></Select.ScrollDownArrow>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

type UiButtonProps = Omit<ComponentProps<typeof Button>, "className"> & {
  className?: string;
  variant?: "default" | "primary" | "quiet" | "danger";
};

export function UiButton({ className = "", variant = "default", ...props }: UiButtonProps) {
  return <Button className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />;
}

interface UiIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function UiIconButton({ label, children, className = "", ...props }: UiIconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger className={`ui-icon-button ${className}`.trim()} aria-label={label} {...props}>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8}>
          <Tooltip.Popup className="ui-tooltip-popup">
            <Tooltip.Arrow className="ui-tooltip-arrow" />
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

interface UiSliderProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function UiSlider({ label, value, onValueChange, min = 0, max = 100, step = 1 }: UiSliderProps) {
  return (
    <Slider.Root className="ui-slider" value={value} onValueChange={onValueChange} min={min} max={max} step={step}>
      <Slider.Control className="ui-slider-control">
        <Slider.Track className="ui-slider-track">
          <Slider.Indicator className="ui-slider-indicator" />
          <Slider.Thumb className="ui-slider-thumb" aria-label={label} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

interface UiProgressProps {
  label: string;
  value: number | null;
  max?: number;
  tone?: "default" | "danger" | "muted";
  showValue?: boolean;
  className?: string;
}

export function UiProgress({ label, value, max = 100, tone = "default", showValue = false, className = "" }: UiProgressProps) {
  return (
    <Progress.Root
      className={`ui-progress ui-progress-${tone} ${className}`.trim()}
      value={value}
      max={max}
      aria-label={label}
      getAriaValueText={(_formatted, current) => current == null ? `${label}: unknown` : `${label}: ${Math.round(current)} of ${max}`}
    >
      {showValue && <><Progress.Label className="ui-progress-label">{label}</Progress.Label><Progress.Value className="ui-progress-value" /></>}
      <Progress.Track className="ui-progress-track"><Progress.Indicator className="ui-progress-indicator" /></Progress.Track>
    </Progress.Root>
  );
}

export function UiToastViewport() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="ui-toast-viewport">
        {toasts.map((toast) => (
          <Toast.Root key={toast.id} toast={toast} className="ui-toast">
            <Toast.Content className="ui-toast-content">
              <div className="ui-toast-text">
                <Toast.Title className="ui-toast-title" />
                <Toast.Description className="ui-toast-description" />
              </div>
              <Toast.Close className="ui-toast-close">Dismiss</Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
