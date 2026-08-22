import { Button } from "@base-ui/react/button";
import { Progress } from "@base-ui/react/progress";
import { Select } from "@base-ui/react/select";
import { Slider } from "@base-ui/react/slider";
import { Toast } from "@base-ui/react/toast";
import { Tooltip } from "@base-ui/react/tooltip";
import { Check, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

export interface PeerOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface PeerSelectProps {
  label: string;
  value: string;
  options: PeerOption[];
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export function PeerSelect({ label, value, options, onValueChange, className = "", disabled = false }: PeerSelectProps) {
  return (
    <div className={`peer-field ${className}`.trim()}>
      <Select.Root
        value={value}
        items={options}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next);
        }}
      >
        <Select.Label className="peer-field-label">{label}</Select.Label>
        <Select.Trigger className="peer-select-trigger">
          <Select.Value className="peer-select-value" />
          <Select.Icon className="peer-select-icon"><ChevronsUpDown size={14} aria-hidden="true" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="peer-select-positioner" sideOffset={4}>
            <Select.Popup className="peer-select-popup">
              <Select.ScrollUpArrow className="peer-select-scroll"><ChevronUp size={14} aria-hidden="true" /></Select.ScrollUpArrow>
              <Select.List className="peer-select-list">
                {options.map((option) => (
                  <Select.Item className="peer-select-item" key={option.value} value={option.value} disabled={option.disabled}>
                    <Select.ItemIndicator className="peer-select-check"><Check size={14} aria-hidden="true" /></Select.ItemIndicator>
                    <Select.ItemText className="peer-select-item-text">{option.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
              <Select.ScrollDownArrow className="peer-select-scroll"><ChevronDown size={14} aria-hidden="true" /></Select.ScrollDownArrow>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

type PeerButtonProps = Omit<ComponentProps<typeof Button>, "className"> & {
  className?: string;
  variant?: "default" | "primary" | "quiet" | "danger";
};

export function PeerButton({ className = "", variant = "default", ...props }: PeerButtonProps) {
  return <Button className={`peer-button peer-button-${variant} ${className}`.trim()} {...props} />;
}

interface PeerIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function PeerIconButton({ label, children, className = "", ...props }: PeerIconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger className={`peer-icon-button ${className}`.trim()} aria-label={label} {...props}>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8}>
          <Tooltip.Popup className="peer-tooltip-popup">
            <Tooltip.Arrow className="peer-tooltip-arrow" />
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

interface PeerSliderProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function PeerSlider({ label, value, onValueChange, min = 0, max = 100, step = 1 }: PeerSliderProps) {
  return (
    <Slider.Root className="peer-slider" value={value} onValueChange={onValueChange} min={min} max={max} step={step}>
      <Slider.Control className="peer-slider-control">
        <Slider.Track className="peer-slider-track">
          <Slider.Indicator className="peer-slider-indicator" />
          <Slider.Thumb className="peer-slider-thumb" aria-label={label} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

interface PeerProgressProps {
  label: string;
  value: number | null;
  max?: number;
  tone?: "default" | "danger" | "muted";
  showValue?: boolean;
  className?: string;
}

export function PeerProgress({ label, value, max = 100, tone = "default", showValue = false, className = "" }: PeerProgressProps) {
  return (
    <Progress.Root
      className={`peer-progress peer-progress-${tone} ${className}`.trim()}
      value={value}
      max={max}
      aria-label={label}
      getAriaValueText={(_formatted, current) => current == null ? `${label}: unknown` : `${label}: ${Math.round(current)} of ${max}`}
    >
      {showValue && <><Progress.Label className="peer-progress-label">{label}</Progress.Label><Progress.Value className="peer-progress-value" /></>}
      <Progress.Track className="peer-progress-track"><Progress.Indicator className="peer-progress-indicator" /></Progress.Track>
    </Progress.Root>
  );
}

export function PeerToastViewport() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="peer-toast-viewport">
        {toasts.map((toast) => (
          <Toast.Root key={toast.id} toast={toast} className="peer-toast">
            <Toast.Content className="peer-toast-content">
              <div className="peer-toast-text">
                <Toast.Title className="peer-toast-title" />
                <Toast.Description className="peer-toast-description" />
              </div>
              <Toast.Close className="peer-toast-close">Dismiss</Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
