import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test';

export { expect } from '@playwright/test';

export interface StepMeta {
  /** The screen this step lands on, for example "help/contact". */
  screen?: string;
  /** The state of that screen after the step, for example "invalid-email". */
  state?: string;
  /**
   * The question this step answers, when its action can end more than one way, for
   * example "Is the email valid?". Word it the same in every scenario that answers it.
   * The user flow draws it once, with one branch per answer.
   */
  decision?: string;
  /** This scenario's answer to `decision`, in a word or two: "Yes", "No". */
  answer?: string;
  /**
   * What to screenshot after the step. "page" (the default) is the whole page,
   * "viewport" is only what is visible, for dialogs and other overlays, and
   * "none" takes no screenshot.
   */
  capture?: 'page' | 'viewport' | 'none';
}

export type Step = {
  (title: string, meta: StepMeta, body: () => Promise<void> | void): Promise<void>;
  (title: string, body: () => Promise<void> | void): Promise<void>;
};

export interface ScenarioArgs {
  page: Page;
  step: Step;
  context: BrowserContext;
  request: APIRequestContext;
  testInfo: TestInfo;
}

export interface FlowOptions {
  /** The states each screen should have, whether or not a scenario reaches them. */
  states?: Record<string, string[]>;
  /** "screen/state" mapped to the reason that state does not apply. */
  notApplicable?: Record<string, string>;
}

export interface ScenarioOptions {
  /** Ids of the requirements this scenario proves, for example ["R1", "R3"]. */
  covers?: string[];
}

export function flow(name: string, body: () => void): void;
export function flow(name: string, options: FlowOptions, body: () => void): void;

export function scenario(title: string, body: (args: ScenarioArgs) => Promise<void>): void;
export function scenario(
  title: string,
  options: ScenarioOptions,
  body: (args: ScenarioArgs) => Promise<void>,
): void;

export const test: typeof import('@playwright/test').test;
