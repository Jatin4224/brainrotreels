"use client"

import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import * as LabelPrimitive from "@radix-ui/react-label"
import { Slot } from "@radix-ui/react-slot"
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

const Form = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue
)

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>")
  }

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

type FormItemContextValue = {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue
)

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId()

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        className={cn("grid gap-2", className)}
        {...props}
      />
    </FormItemContext.Provider>
  )
}

function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId } = useFormField()

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  )
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <Slot
      data-slot="form-control"
      id={formItemId}
      aria-describedby={
        !error
          ? `${formDescriptionId}`
          : `${formDescriptionId} ${formMessageId}`
      }
      aria-invalid={!!error}
      {...props}
    />
  )
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField()

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

// A validation message used to MOUNT, which shoved every field below it —
// and the submit button — down a line at the exact moment somebody was
// looking at the field they got wrong. Its height is animated for the same
// reason an accordion's is: there is no transform that makes room.
//
// This is deliberately the SAME recipe as AuthError (see
// components/global/auth/auth-error.tsx) rather than a second idiom — one
// auth screen renders both, and two ways of saying "something is wrong"
// arriving at two speeds is what reads as sloppy.
//
// initial={false} is the part that is easy to drop: a form rendered with an
// error already in it (a server-returned error, or a re-mount) must not play
// an entrance, because that claims the error just happened.
//
// transform as a STRING, not framer-motion's y shorthand: on framer-motion 13
// the shorthands animate on the main thread.
function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error?.message ?? "") : props.children
  // Reduced motion keeps the height and the fade — they are what stop the
  // jump — and drops the 4px of travel, which is the vestibular part.
  const reduce = useReducedMotion()
  const offset = reduce ? "translateY(0px)" : "translateY(-4px)"

  return (
    <AnimatePresence initial={false}>
      {body ? (
        <motion.div
          key="form-message"
          initial={{ opacity: 0, height: 0, transform: offset }}
          animate={{
            opacity: 1,
            height: "auto",
            transform: "translateY(0px)",
          }}
          exit={{ opacity: 0, height: 0, transform: offset }}
          // 180ms in, with the opacity shorter again so the words are legible
          // before the box has finished opening. The curve is --ease-settle's
          // control points: this file cannot read the CSS token.
          transition={{
            duration: 0.18,
            ease: [0.3, 0.7, 0.2, 1],
            opacity: { duration: 0.14 },
          }}
          style={{ overflow: "hidden" }}
        >
          <p
            data-slot="form-message"
            id={formMessageId}
            className={cn("text-destructive text-sm", className)}
            {...props}
          >
            {body}
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
}
