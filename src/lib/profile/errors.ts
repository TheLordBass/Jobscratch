/** A problem reading the candidate's website or GitHub, worded for the user. */
export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}
