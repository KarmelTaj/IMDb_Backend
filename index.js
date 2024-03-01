const express = require('express');
const postgres = require('postgres');
require('dotenv').config();
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }))


app.use(function (_, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);
  next();
});

const port = 3001;

// app.js
let { PGHOST, PGDATABASE, PGUSER, PGPASSWORD, ENDPOINT_ID } = process.env;

const sql = postgres({
  host: PGHOST,
  database: PGDATABASE,
  username: PGUSER,
  password: PGPASSWORD,
  port: 5432,
  ssl: 'require',
  connection: {
    options: `project=${ENDPOINT_ID}`,
  },
});

async function getPgVersion() {

  try {
    const result = await sql`select version()`;
  } catch (error) {
    response.send('Internal Server Error, Getting PgVersion');
  }
}

getPgVersion();

app.get('/movies', async (_, response) => {
  try {
    const movies = await sql`select * from movies`;
    response.send(movies);
  } catch (error) {
    response.send('Internal Server Error, Get Movies');
  }
});


app.get('/movies/:id', async (request, response) => {
  try {
    const movieId = +request.params.id;

    const movieDetails = await sql`
          SELECT
              movies.*,
              jsonb_agg(DISTINCT jsonb_build_object('name', stars.name, 'picture', stars.picture)) AS stars,
              array_agg(DISTINCT genres.name) AS genres
          FROM
              movies
          JOIN
              movies_stars ON movies.id = movies_stars.movieID
          JOIN
              stars ON movies_stars.starID = stars.id
          JOIN
              movies_genres ON movies.id = movies_genres.movieID
          JOIN
              genres ON movies_genres.genreID = genres.id
          WHERE
              movies.id = ${movieId}
          GROUP BY
              movies.id;
      `;

    // Since we're querying a single movie, movieDetails will be an array with one element
    const movie = movieDetails[0];

    if (movie) {
      response.send(movie);
    } else {
      response.send('Movie not found');
    }
  } catch (error) {
    response.send('Internal Server Error, Get Moive:ID');
  }
});



app.post('/login', async (request, response) => {
  try {
    const { username, password } = request.body;
    const foundUser = await sql`SELECT * FROM users WHERE username = ${username} AND password = ${password};`;

    if (foundUser && foundUser.length > 0) {
      response.send({ user: { id: foundUser[0].id, username: foundUser[0].username, isadmin: foundUser[0].isadmin } });
    } else {
      response.send({ error: true, message: 'Wrong Username and/or Password' });
    }
  } catch (error) {
    response.send('Internal Server Error, Post Login');
  }
});



app.post('/sign-up', async (request, response) => {
  try {
    const { username, password } = request.body;
    const foundUser = await sql`SELECT * FROM users WHERE username = ${username};`;

    if (foundUser && foundUser.length > 0) {
      response.send({ error: true, message: 'User already exists' });
    } else {
      const newUser = await sql`
        INSERT INTO Users (Username, Password, IsAdmin)
        VALUES (${username}, ${password}, false)
        RETURNING *;`;

      if (newUser && newUser.length > 0) {
        response.send({ user: { id: newUser[0].id, username: newUser[0].username, isadmin: newUser[0].isadmin } });
      } else {
        response.send({ success: false, message: 'Failed to create user' });
      }
    }
  } catch (error) {
    console.error('Error creating user:', error);
    response.send({ success: false, message: 'Internal server error, Post Sign up' });
  }
});




app.post('/movies/:movieID/rate-movie', async (request, response) => {
  const { movieID } = request.params; // Extract movieID from the URL parameter
  const { userID, rate } = request.body;

  try {
    // Assuming 'rates' table has columns: movieID, userID, rate
    const result = await sql`
      INSERT INTO rates (movieID, userID, rate)
      VALUES (${+movieID}, ${+userID}, ${+rate})
      RETURNING *;`;

    // Check if the row was successfully inserted
    if (result && result.length > 0) {
      response.send({ success: true, message: 'Rating added successfully' });
    } else {
      response.send({ success: false, message: 'Failed to add rating' });
    }
  } catch (error) {
    response.send({ success: false, message: 'Internal server error, Post Rate Movie' });
  }
});


app.post('/admin/add-star', async (request, response) => {
  try {
    const { name, picture } = request.body;

    // Check if the star already exists
    const foundStar = await sql`SELECT * FROM Stars WHERE Name = ${name}`;

    if (foundStar && foundStar.length > 0) {
      response.send({ error: true, message: 'Star already exists' });
    } else {
      // Insert the new star
      const newStar = await sql`
      INSERT INTO Stars (Name, Picture)
      VALUES (${name}, ${picture})
        RETURNING *;`;

      if (newStar && newStar.length > 0) {
        response.send({ star: newStar[0] });
      } else {
        response.send({ success: false, message: 'Failed to create star' });
      }
    }
  } catch (error) {
    console.error('Error creating star:', error);
    response.send({ success: false, message: 'Internal server error, Post Add Star' });
  }
});


app.get('/admin/add-movie', async (_, response) => {
  try {
    const genres = await sql`SELECT * FROM Genres;`;
    const stars = await sql`SELECT * FROM Stars;`;
    const movies = await sql`SELECT title FROM movies;`;
    response.send({ genres: genres, stars: stars, movies: movies });
  } catch (error) {
    response.send('Internal Server Error, Get Add Movie');
  }
});



app.post('/admin/add-movie', async (request, response) => {
  try {
    const { title, year, duration, description, director, posterUrl, backdropUrl, mpa, selectedStars, selectedGenres } = request.body;

    // Insert the new movie
    const newMovie = await sql`
      INSERT INTO Movies (Title, Year, Duration, Description, Director, PosterURL, BackdropURL, MPA)
      VALUES (${title}, ${year}, ${duration}, ${description}, ${director}, ${posterUrl}, ${backdropUrl}, ${mpa})
      RETURNING *;`;

    if (newMovie && newMovie.length > 0) {
      const movieID = newMovie[0].id;

      // Create arrays to store inserted stars and genres
      const insertedStars = [];
      const insertedGenres = [];

      // Insert selected stars into movies_stars table
      await Promise.all(selectedStars.map(async starName => {
        const star = await sql`
          SELECT * FROM Stars
          WHERE Name = ${starName};`;

        if (star && star.length > 0) {
          const starID = star[0].id;

          // Insert into movies_stars with RETURNING *
          const insertedStar = await sql`
            INSERT INTO movies_stars (movieID, starID)
            VALUES (${movieID}, ${starID})
            RETURNING *;`;

          insertedStars.push(insertedStar[0]);
        }
      }));

      // Insert selected genres into movies_genres table
      await Promise.all(selectedGenres.map(async genreName => {
        const genre = await sql`
          SELECT * FROM Genres
          WHERE Name = ${genreName};`;

        if (genre && genre.length > 0) {
          const genreID = genre[0].id;

          // Insert into movies_genres with RETURNING *
          const insertedGenre = await sql`
            INSERT INTO movies_genres (movieID, genreID)
            VALUES (${movieID}, ${genreID})
            RETURNING *;`;

          insertedGenres.push(insertedGenre[0]);
        }
      }));

      response.send({ movie: newMovie[0], stars: insertedStars, genres: insertedGenres });
    } else {
      response.send({ success: false, message: 'Failed to Add Movie' });
    }
  } catch (error) {
    response.send({ success: false, message: 'Internal server error, Post Add Movie' });
  }
});

app.get('/admin/delete-movie', async (_, response) => {
  try {
    const movies = await sql`SELECT id, title FROM movies;`;
    response.send({ movies });
  } catch (error) {
    response.send('Internal Server Error, Get Delet Movie');
  }
});



app.delete('/admin/delete-movie', async (request, response) => {
  const { id } = request.body;
  try {
    const deletedMovie = await sql`
      DELETE FROM Movies
      WHERE Id = ${id}
      RETURNING *;`;

    if (deletedMovie && deletedMovie.length > 0) {
      response.json({ success: true, movie: deletedMovie[0] });
    } else {
      response.json({ success: false, message: 'Movie not found' });
    }

  } catch (error) {
    console.error('Error deleting movie:', error);
    response.send({ success: false, message: 'Internal server error, Delete Movie' });
  }
});


app.listen(port, () => console.log(`My App listening at http://localhost:${port}`));
