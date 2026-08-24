const USER_ROLES = Object.freeze({
  COACH: 'coach',
  STUDENT: 'student',
  PLAYER: 'player'
});

const USER_ROLE_VALUES = Object.values(USER_ROLES);

module.exports = { USER_ROLES, USER_ROLE_VALUES };
